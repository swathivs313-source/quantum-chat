import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

async def force_verify():
    load_dotenv(Path(__file__).parent / '.env', override=True)
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    
    print(f"Connecting to {mongo_url}, DB: {db_name}")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    
    emails_to_verify = [
        "swathivs7090497610@gmail.com",
        "jayavardhinic39@gmail.com"
    ]
    
    for email in emails_to_verify:
        result = await db.users.update_one(
            {"email": email},
            {"$set": {"is_verified": True}}
        )
        if result.matched_count > 0:
            print(f"SUCCESS: Force-verified {email}")
        else:
            print(f"WARNING: User with email {email} not found")

if __name__ == "__main__":
    asyncio.run(force_verify())
