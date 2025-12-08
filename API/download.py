import yt_dlp
import os

def download_audio_from_url(url, output_dir="./downloads", filename_template="%(title)s.%(ext)s"):
    """
    Downloads audio from the given URL using yt-dlp.

    Parameters:
    - url (str): The URL of the video to download audio from.
    - output_dir (str): The directory where the downloaded audio will be saved.
    - filename_template (str): The template for naming the downloaded file.

    Returns:
    - str: The path to the downloaded audio file.
    """
    os.makedirs(output_dir, exist_ok=True)

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(output_dir, filename_template),
        # Uncomment the following lines to convert to mp3 if ffmpeg is installed
        # 'postprocessors': [{
        #     'key': 'FFmpegExtractAudio',
        #     'preferredcodec': 'mp3',
        #     'preferredquality': '192',
        # }],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)

    return filename, info