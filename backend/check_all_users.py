import motor.motor_asyncio
import asyncio

async def check():
    client = motor.motor_asyncio.AsyncIOMotorClient('mongodb://localhost:27017')
    # Updated to the correct database name from .env
    db = client.test_database
    
    users = await db.users.find({}, {"password_hash": 0}).to_list(100)
    print(f"TOTAL USERS FOUND: {len(users)}")
    for u in users:
        print(f"ID: {u['_id']} | NAME: {u.get('name')} | EMAIL: {u.get('email')}")
        
    client.close()

if __name__ == "__main__":
    asyncio.run(check())
