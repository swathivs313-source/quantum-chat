from dotenv import load_dotenv
from pathlib import Path
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv(Path(__file__).parent / '.env', override=True)

smtp_email = os.environ.get("SMTP_EMAIL")
smtp_password = os.environ.get("SMTP_PASSWORD")

# Try to send to a different email to see if Gmail blocks external recipients
test_recipient = "swathivs914@gmail.com" 

print(f"Testing SMTP login for: {smtp_email}")
print(f"Sending test email to: {test_recipient}")

try:
    msg = MIMEMultipart()
    msg["From"] = smtp_email
    msg["To"] = test_recipient
    msg["Subject"] = "Test External Email"
    msg.attach(MIMEText("This is a test to verify sending to an external recipient.", "plain"))

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
        server.set_debuglevel(1) # Enable verbose output
        server.starttls()
        server.login(smtp_email, smtp_password)
        server.send_message(msg)
    print("SUCCESS: External email sent successfully!")
except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {str(e)}")
    traceback.print_exc()
