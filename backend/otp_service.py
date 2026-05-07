import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)


def send_sms_otp(phone_number: str, otp_code: str) -> bool:
    try:
        from twilio.rest import Client
        sid = os.environ.get("TWILIO_ACCOUNT_SID")
        token = os.environ.get("TWILIO_AUTH_TOKEN")
        from_number = os.environ.get("TWILIO_PHONE_NUMBER")
        if not all([sid, token, from_number]):
            logger.warning("Twilio credentials not configured")
            return False
        client = Client(sid, token)
        message = client.messages.create(
            body=f"Your Quantum-Safe Chat code is: {otp_code}. Valid for 5 minutes.",
            from_=from_number,
            to=phone_number
        )
        logger.info(f"SMS OTP sent to {phone_number}, SID: {message.sid}")
        return True
    except Exception as e:
        logger.error(f"SMS OTP failed for {phone_number}: {e}")
        return False


def send_email_otp(email: str, otp_code: str) -> bool:
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        import os

        smtp_email = os.environ.get("SMTP_EMAIL")
        smtp_password = os.environ.get("SMTP_PASSWORD")
        if not smtp_email or not smtp_password:
            logger.warning("SMTP credentials not configured")
            return False

        msg = MIMEMultipart()
        msg["From"] = smtp_email
        msg["To"] = email
        msg["Subject"] = "Quantum-Safe Chat - Verification Code"

        body = (
            f"Your verification code is: {otp_code}\n\n"
            f"This code is valid for 5 minutes.\n"
            f"Do not share this code with anyone.\n\n"
            f"- Quantum-Safe Secure Chat"
        )
        msg.attach(MIMEText(body, "plain"))

        brevo_api_key = os.environ.get("BREVO_API_KEY")
        if brevo_api_key:
            import requests
            logger.info(f"Attempting HTTP send to {email} using Brevo API")
            url = "https://api.brevo.com/v3/smtp/email"
            payload = {
                "sender": {"email": smtp_email, "name": "Quantum-Safe Chat"},
                "to": [{"email": email}],
                "subject": "Quantum-Safe Chat - Verification Code",
                "htmlContent": f"<html><body><p>Your verification code is: <b>{otp_code}</b></p><p>This code is valid for 5 minutes.<br>Do not share this code with anyone.</p><p>- Quantum-Safe Secure Chat</p></body></html>"
            }
            headers = {
                "accept": "application/json",
                "api-key": brevo_api_key,
                "content-type": "application/json"
            }
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
        else:
            logger.info(f"Attempting SMTP send to {email} using sender {smtp_email}")
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
                server.set_debuglevel(1)
                server.starttls()
                server.login(smtp_email, smtp_password)
                server.send_message(msg)

        logger.info(f"Email OTP sent successfully to {email}")
        return True
    except Exception as e:
        import traceback
        error_info = traceback.format_exc()
        logger.error(f"STRICT_DEBUG: Email OTP failed for {email}.\nError: {e}\nTraceback: {error_info}")
        return False


def deliver_otp(phone_number: str, email: str, otp_code: str) -> dict:
    """Try SMS first, fallback to email, then demo mode"""
    if phone_number:
        if send_sms_otp(phone_number, otp_code):
            return {"method": "sms", "sent": True}
    if email:
        if send_email_otp(email, otp_code):
            return {"method": "email", "sent": True}
    logger.warning(f"OTP delivery failed for {email}, using demo mode")
    return {"method": "demo", "sent": False, "demo_otp": otp_code}
