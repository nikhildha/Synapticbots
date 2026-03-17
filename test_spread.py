import requests

url = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt"
resp = requests.get(url).json()

btc = resp['prices']['B-BTC_USDT']
print(f"BTC LTP: {btc.get('ls')} | Bid: {btc.get('bid')} | Ask: {btc.get('ask')}")
