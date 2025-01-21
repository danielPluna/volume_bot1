import { balanceMonitor, formatBalance } from './current_balances.js';

// Pool Constants
const BLND_WEIGHT = 0.8;
const USDC_WEIGHT = 0.2;
const SWAP_FEE = 0.003;  // 30 basis points

let lastPrice = null;

/**
 * Calculates spot price using weighted formula with fee adjustment
 * SP = (BUSDC/0.2)/(BBLND/0.8) * 1/(1-0.003)
 */
function calculateSpotPrice(usdcBalance, blndBalance) {
    // Convert balances to decimal numbers
    const BUSDC = Number(formatBalance(usdcBalance));
    const BBLND = Number(formatBalance(blndBalance));
    
    // Calculate weighted ratios
    const weightedUSDC = BUSDC / USDC_WEIGHT;
    const weightedBLND = BBLND / BLND_WEIGHT;
    
    // Calculate base price and apply fee adjustment
    const basePrice = weightedUSDC / weightedBLND;
    const feeAdjustment = 1 / (1 - SWAP_FEE);
    
    return basePrice * feeAdjustment;
}

// Calculate and display spot price whenever balances update
balanceMonitor.on('balanceUpdate', ({ ledger, blnd, usdc }) => {
    console.log(`\nLedger update detected: ${ledger}`);
    
    // Calculate spot price
    const spotPrice = calculateSpotPrice(usdc, blnd);
    const formattedPrice = spotPrice.toFixed(7);
    
    console.log("\nCurrent State:");
    console.log(`BLND Balance: ${formatBalance(blnd)}`);
    console.log(`USDC Balance: ${formatBalance(usdc)}`);
    console.log(`Spot Price: ${formattedPrice} USDC/BLND`);
    
    if (lastPrice !== null) {
        const priceChange = spotPrice - Number(lastPrice);
        const changeDirection = priceChange >= 0 ? '+' : '';
        console.log(`Price Change: ${changeDirection}${priceChange.toFixed(7)} USDC/BLND`);
    }
    
    lastPrice = formattedPrice;
});

// Display initial configuration
console.log(`Starting CAS3 spot price monitor...`);
console.log(`BLND Weight: ${BLND_WEIGHT}`);
console.log(`USDC Weight: ${USDC_WEIGHT}`);
console.log(`Swap Fee: ${SWAP_FEE * 100}%`);

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nStopping spot price monitor...');
    process.exit(0);
});