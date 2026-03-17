import requests
import json

urls = [
    "https://sentinel-production-cf1c.up.railway.app/api/all",
    "https://sentinel-production-cf1c.up.railway.app/api/health",
    "https://sentinel-production-cf1c.up.railway.app/api/gemini-health"
]

for url in urls:
    try:
        resp = requests.get(url, timeout=5)
        print(f"URL: {url}")
        print(f"Status: {resp.status_code}")
        print(json.dumps(resp.json(), indent=2)[:500])
        print("-" * 40)
    except Exception as e:
        print(f"Failed {url}: {e}")
