from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env', override=True)

from otp_service import deliver_otp

print("Testing deliver_otp to swathivs914@gmail.com...")
result = deliver_otp("", "swathivs914@gmail.com", "123456")
print(result)
