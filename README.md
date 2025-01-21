current_balances.js Fetches current balances

spot_priceBLND.js Calculates current spot price of BLND

initial order.js Places initial 20 orders of 500 units at steps of 0.5% difference from calculated spot price

order_monitor.js All processes killed and restart when either the balances change or the order get filled, if order is filled does not restart until that is refclected in balances

should the order unit amount be radomized so that any random 500 unit order wont trigger the bot to go ahead?
