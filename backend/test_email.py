from dotenv import load_dotenv
from pathlib import Path
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv(Path(__file__).parent / '.env', override=True)

smtp_email = os.environ.get("SMTP_EMAIL")
smtp_password = os.environ.get("SMTP_PASSWORD")

print(f"Testing SMTP login for: {smtp_email}")
print(f"Password length: {len(smtp_password) if smtp_password else 0}")

try:
    msg = MIMEMultipart()
    msg["From"] = smtp_email
    msg["To"] = smtp_email
    msg["Subject"] = "Test Email"
    msg.attach(MIMEText("This is a test to verify SMTP configuration.", "plain"))

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
        server.starttls()
        server.login(smtp_email, smtp_password)
        server.send_message(msg)
    print("SUCCESS: Email sent successfully!")
except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {str(e)}")
    traceback.print_exc()
