import { balanceMonitor } from './current_balances.js';
import { calculateSpotPrice } from './spot_priceBLND.js';
import {
    Account,
    Address,
    Contract,
    rpc,
    TransactionBuilder,
    TimeoutInfinite,
    xdr,
    Keypair,
} from '@stellar/stellar-sdk';

// Contract addresses
export const CAS3_CONTRACT = "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
export const BLND_TOKEN_CONTRACT = "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY";
export const USDC_TOKEN_CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const SOROBAN_RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

// Trading configuration
const BUCKET_INCREMENT = 0.005; // 0.5%
const NUM_BUCKETS = 10;
const ORDER_SIZE = 500; // Fixed 500 unit size
const PRIVATE_KEY = 'YOUR_PRIVATE_KEY';

// Export active orders for the tracker
export let activeOrders = new Map();

class PriceLadder {
    constructor(spotPrice) {
        this.spotPrice = spotPrice;
        this.buyLevels = [];
        this.sellLevels = [];
        this.calculateLevels();
    }

    calculateLevels() {
        // Calculate buy levels (below spot)
        for (let i = 1; i <= NUM_BUCKETS; i++) {
            const discount = 1 - (BUCKET_INCREMENT * i);
            this.buyLevels.push({
                price: this.spotPrice * discount,
                level: i,
                side: 'buy'
            });
        }

        // Calculate sell levels (above spot)
        for (let i = 1; i <= NUM_BUCKETS; i++) {
            const premium = 1 + (BUCKET_INCREMENT * i);
            this.sellLevels.push({
                price: this.spotPrice * premium,
                level: i,
                side: 'sell'
            });
        }

        console.log('\nPrice Ladder:');
        console.log('Buy Levels:');
        this.buyLevels.forEach(level => 
            console.log(`Level ${level.level}: ${level.price.toFixed(7)} USDC/BLND`)
        );
        console.log('\nSell Levels:');
        this.sellLevels.forEach(level => 
            console.log(`Level ${level.level}: ${level.price.toFixed(7)} USDC/BLND`)
        );
    }

    isWithinRange(price) {
        const lowestBuy = this.buyLevels[NUM_BUCKETS - 1].price;
        const highestSell = this.sellLevels[NUM_BUCKETS - 1].price;
        return price >= lowestBuy && price <= highestSell;
    }
}

class OrderManager {
    constructor() {
        this.clearOrders();
    }

    clearOrders() {
        activeOrders.clear();
    }

    async placeLimitOrder(price, isBuy, level) {
        try {
            const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: false, timeout: 30000 });
            const sourceKeypair = Keypair.fromSecret(PRIVATE_KEY);
            const account = await server.getAccount(sourceKeypair.publicKey());

            const amountInBaseUnits = BigInt(Math.floor(ORDER_SIZE * 10000000));
            const priceInBaseUnits = BigInt(Math.floor(price * 10000000));

            const tx = new TransactionBuilder(account, {
                fee: '100000',
                networkPassphrase: NETWORK_PASSPHRASE,
            })
            .setTimeout(TimeoutInfinite)
            .addOperation(new Contract(CAS3_CONTRACT).call(
                isBuy ? 'place_buy_order' : 'place_sell_order',
                [
                    new Address(BLND_TOKEN_CONTRACT).toScVal(),
                    new Address(USDC_TOKEN_CONTRACT).toScVal(),
                    xdr.ScVal.scvI128(amountInBaseUnits),
                    xdr.ScVal.scvI128(priceInBaseUnits),
                ]
            ))
            .build();

            tx.sign(sourceKeypair);
            const result = await server.sendTransaction(tx);
            
            const orderInfo = {
                id: result.hash,
                price,
                amount: ORDER_SIZE,
                side: isBuy ? 'buy' : 'sell',
                level,
                timestamp: Date.now()
            };
            
            activeOrders.set(level, orderInfo);
            console.log(`Order placed: ${isBuy ? 'BUY' : 'SELL'} ${ORDER_SIZE} BLND at ${price.toFixed(7)} USDC (Level ${level})`);
            
            return orderInfo;
        } catch (error) {
            console.error('Error placing order:', error);
            throw error;
        }
    }
}

class LadderTradingBot {
    constructor() {
        this.orderManager = new OrderManager();
        this.priceLadder = null;
        this.initialBalancesReceived = false;
    }

    async updateOrders(spotPrice) {
        // Clear existing orders
        this.orderManager.clearOrders();
        
        // Create new price ladder
        this.priceLadder = new PriceLadder(spotPrice);

        // Place buy orders
        for (const level of this.priceLadder.buyLevels) {
            await this.orderManager.placeLimitOrder(
                level.price,
                true,
                `buy_${level.level}`
            );
        }

        // Place sell orders
        for (const level of this.priceLadder.sellLevels) {
            await this.orderManager.placeLimitOrder(
                level.price,
                false,
                `sell_${level.level}`
            );
        }
    }

    start() {
        console.log('Starting CAS3 ladder trading bot...');
        console.log(`Order size: ${ORDER_SIZE} BLND`);
        console.log(`Number of buckets: ${NUM_BUCKETS}`);
        console.log(`Bucket increment: ${BUCKET_INCREMENT * 100}%`);

        // Wait for initial balance update before placing orders
        balanceMonitor.on('balanceUpdate', async ({ blnd, usdc }) => {
            // Wait for first balance update to ensure accurate data
            if (!this.initialBalancesReceived) {
                this.initialBalancesReceived = true;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const spotPrice = calculateSpotPrice(usdc, blnd);
            
            if (!this.priceLadder || !this.priceLadder.isWithinRange(spotPrice)) {
                console.log('\nPrice moved outside ladder range - updating orders...');
                await this.updateOrders(spotPrice);
            }
        });
    }

    stop() {
        this.orderManager.clearOrders();
    }
}

// Start the bot
const bot = new LadderTradingBot();
bot.start();

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nStopping ladder trading bot...');
    bot.stop();
    process.exit(0);
});

// Export bot instance for external management
export const tradingBot = bot;