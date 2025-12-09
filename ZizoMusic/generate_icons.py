import os
from PIL import Image

source_path = r"D:\Projects\YoutubeMusic\API\favicon.png"
res_path = r"D:\Projects\YoutubeMusic\ZizoMusic\android\app\src\main\res"

icon_sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
}

def generate_icons():
    if not os.path.exists(source_path):
        print(f"Error: Source file not found at {source_path}")
        return

    try:
        img = Image.open(source_path)
        # Ensure image is square
        if img.width != img.height:
            print("Warning: Source image is not square. It will be resized/distorted.")
        
        for folder, size in icon_sizes.items():
            folder_path = os.path.join(res_path, folder)
            if not os.path.exists(folder_path):
                os.makedirs(folder_path)
            
            # Resize image
            resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
            
            # Save as ic_launcher.png
            launcher_path = os.path.join(folder_path, "ic_launcher.png")
            resized_img.save(launcher_path)
            print(f"Saved {launcher_path}")
            
            # Save as ic_launcher_round.png (using same image for now)
            round_path = os.path.join(folder_path, "ic_launcher_round.png")
            resized_img.save(round_path)
            print(f"Saved {round_path}")
            
        print("Icon generation complete.")
        
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    generate_icons()
