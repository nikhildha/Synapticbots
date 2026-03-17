import requests

url = "https://public.coindcx.com/market_data/v3/orderbook/futures/rt"
resp = requests.get(url).json()

# Let's inspect B-BTC_USDT structure
if 'B-BTC_USDT' in resp.get('order_books', {}):
    btc = resp['order_books']['B-BTC_USDT']
    print("BTC Order Book Snapshot:")
    print("Top Bid:", btc.get('bids', [None])[0])
    print("Top Ask:", btc.get('asks', [None])[0])
else:
    print("No order book for B-BTC_USDT. Keys:", list(resp.keys()))
