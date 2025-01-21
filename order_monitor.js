import { spawn } from 'child_process';
import { balanceMonitor, getBalance } from './current_balances.js';
import {
    rpc,
    Contract,
    Address,
} from '@stellar/stellar-sdk';

const SOROBAN_RPC_URL = "https://mainnet.sorobanrpc.com";
const CAS3_CONTRACT = "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
const BLND_TOKEN_CONTRACT = "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY";
const USDC_TOKEN_CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

class ProcessManager {
    constructor() {
        this.processes = new Map();
        this.server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: false, timeout: 30000 });
        this.isRestarting = false;
        this.lastBalances = null;
    }

    async startProcess(name, script) {
        console.log(`Starting ${name}...`);
        const process = spawn('node', [script], { stdio: 'inherit' });
        
        process.on('error', (error) => {
            console.error(`${name} error:`, error);
        });

        process.on('exit', (code, signal) => {
            if (code !== null) {
                console.log(`${name} exited with code ${code}`);
            } else if (signal !== null) {
                console.log(`${name} was killed with signal ${signal}`);
            }
        });

        this.processes.set(name, process);
        
        // Wait for process initialization
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    async startAllProcesses() {
        try {
            await this.startProcess('balances', 'current_balances.js');
            await this.startProcess('spot_price', 'spot_priceBLND.js');
            await this.startProcess('orders', 'initial_order.js');
            
            console.log('All processes started successfully');
        } catch (error) {
            console.error('Error starting processes:', error);
            await this.killAllProcesses();
            throw error;
        }
    }

    async killAllProcesses() {
        console.log('Stopping all processes...');
        
        for (const [name, process] of this.processes) {
            console.log(`Stopping ${name}...`);
            process.kill();
        }
        
        this.processes.clear();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    hasBalanceChanged(newBalances) {
        if (!this.lastBalances) return false;
        // Check for any difference at all in either balance
        return newBalances.blnd !== this.lastBalances.blnd || 
               newBalances.usdc !== this.lastBalances.usdc;
    }

    async checkOrderStatus(activeOrders) {
        try {
            const contract = new Contract(CAS3_CONTRACT);
            
            for (const [level, order] of Object.entries(activeOrders)) {
                const result = await this.server.simulateTransaction(
                    contract.call('get_order_status', order.id)
                );
                
                if (result.status === 'filled') {
                    console.log(`Order filled at level ${level}!`);
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('Error checking order status:', error);
            return false;
        }
    }

    async handleStateChange(reason) {
        if (this.isRestarting) return;
        
        try {
            this.isRestarting = true;
            
            console.log(`\nState change detected (${reason}), restarting processes...`);
            await this.killAllProcesses();
            
            // Brief pause to ensure clean shutdown
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('Restarting all processes...');
            await this.startAllProcesses();
            
        } catch (error) {
            console.error('Error handling state change:', error);
        } finally {
            this.isRestarting = false;
        }
    }

    async start() {
        console.log('Starting order monitor...');
        
        try {
            await this.startAllProcesses();

            // Monitor balance changes
            balanceMonitor.on('balanceUpdate', async ({ blnd, usdc }) => {
                const newBalances = { blnd, usdc };
                
                if (this.lastBalances && !this.isRestarting && 
                    this.hasBalanceChanged(newBalances)) {
                    await this.handleStateChange('balance change');
                }
                
                this.lastBalances = newBalances;
            });
            
            // Monitor for order fills
            setInterval(async () => {
                if (!this.isRestarting) {
                    try {
                        const { activeOrders } = await import('./initial_order.js');
                        
                        if (activeOrders && activeOrders.size > 0) {
                            const orderFilled = await this.checkOrderStatus(activeOrders);
                            if (orderFilled) {
                                await this.handleStateChange('order filled');
                            }
                        }
                    } catch (error) {
                        console.error('Error in monitoring loop:', error);
                    }
                }
            }, 5000);
            
        } catch (error) {
            console.error('Error starting monitor:', error);
            await this.killAllProcesses();
            process.exit(1);
        }
    }
}

// Start the monitor
const monitor = new ProcessManager();

// Handle shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down order monitor...');
    await monitor.killAllProcesses();
    process.exit(0);
});

monitor.start().catch(error => {
    console.error('Failed to start monitor:', error);
    process.exit(1);
});