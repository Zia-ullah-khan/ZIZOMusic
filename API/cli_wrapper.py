import sys
import YouTubeMusicAPI
from download import download_audio_from_url

def main():
    if len(sys.argv) < 2:
        print("Usage: python cli_wrapper.py <search_query>")
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    print(f"Searching for: {query}")
    
    try:
        results = YouTubeMusicAPI.search(query)
        if results and 'url' in results:
            url = results['url']
            print(f"Found URL: {url}")
            output_path = download_audio_from_url(url, output_dir="./songs")
            print(f"Downloaded to: {output_path}")
        else:
            print("No results found.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
