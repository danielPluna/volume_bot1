import {
    Account,
    Address,
    Contract,
    rpc,
    scValToNative,
    TransactionBuilder,
    TimeoutInfinite,
} from '@stellar/stellar-sdk';
import EventEmitter from 'events';

// Constants
export const CAS3_CONTRACT = "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
export const BLND_TOKEN_CONTRACT = "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY";
export const USDC_TOKEN_CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const SOROBAN_RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

// Format balance with 7 decimal places
export function formatBalance(balance) {
    const balanceStr = balance.toString();
    return balanceStr.slice(0, -7) + "." + balanceStr.slice(-7);
}

// Get token balance
async function getBalance(tokenContract) {
    const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: false, timeout: 30000 });
    const account = new Account('GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4', '123');
    
    const tx = new TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: NETWORK_PASSPHRASE,
    })
    .setTimeout(TimeoutInfinite)
    .addOperation(new Contract(tokenContract).call(
        'balance', 
        new Address(CAS3_CONTRACT).toScVal()
    ))
    .build();

    const result = await server.simulateTransaction(tx);
    return scValToNative(result.result.retval);
}

// Get latest ledger
async function getLatestLedger() {
    const response = await fetch(SOROBAN_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getLatestLedger"
        })
    });
    const data = await response.json();
    return data.result.sequence;
}

// Create balance monitor emitter
export const balanceMonitor = new EventEmitter();

// Main monitoring loop
let lastLedger = null;

async function checkUpdates() {
    try {
        const currentLedger = await getLatestLedger();
        
        if (lastLedger !== currentLedger) {
            const blnd = await getBalance(BLND_TOKEN_CONTRACT);
            const usdc = await getBalance(USDC_TOKEN_CONTRACT);
            
            // Emit balance updates
            balanceMonitor.emit('balanceUpdate', {
                ledger: currentLedger,
                blnd: blnd,
                usdc: usdc
            });
            
            lastLedger = currentLedger;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Start monitoring
setInterval(checkUpdates, 5000);
checkUpdates();

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nStopping balance monitor...');
    process.exit(0);
});