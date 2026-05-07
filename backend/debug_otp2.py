from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env', override=True)

from otp_service import deliver_otp

print("Testing deliver_otp with phone number and email...")
try:
    result = deliver_otp("+918105020629", "swathivs914@gmail.com", "123456")
    print(result)
except Exception as e:
    import traceback
    traceback.print_exc()
