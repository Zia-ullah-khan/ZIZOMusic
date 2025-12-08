import YouTubeMusicAPI
from download import download_audio_from_url

query = "Imagine Dragons Believer"
results = YouTubeMusicAPI.search(query)
url = results['url']

download_audio_from_url(url, output_dir="./songs")