import zipfile
import os

PROJECT_DIR = r"c:\Users\swath\Downloads\quantum-chat"
OUTPUT_ZIP = os.path.join(os.path.dirname(PROJECT_DIR), "quantum-chat.zip")

# Only exclude the zip itself and this script
EXCLUDE_FILES = {'quantum-chat.zip', 'create_zip.py'}

count = 0
with zipfile.ZipFile(OUTPUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(PROJECT_DIR):
        for file in files:
            if file in EXCLUDE_FILES:
                continue
            filepath = os.path.join(root, file)
            arcname = os.path.join('quantum-chat', os.path.relpath(filepath, PROJECT_DIR))
            zf.write(filepath, arcname)
            count += 1

size_mb = os.path.getsize(OUTPUT_ZIP) / (1024 * 1024)
print(f"Done! Zipped {count} files.")
print(f"Output: {OUTPUT_ZIP}")
print(f"Size: {size_mb:.2f} MB")
