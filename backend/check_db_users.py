import motor.motor_asyncio
import asyncio
from bson import ObjectId

async def check():
    client = motor.motor_asyncio.AsyncIOMotorClient('mongodb://localhost:27017')
    db = client.trunex
    
    # 1. Check current user
    me = await db.users.find_one({'email': 'swathivs7090497610@gmail.com'})
    print(f"ME: {me['name']} ({me['_id']})")
    
    # 2. Check Alice
    alice = await db.users.find_one({'name': 'Alice Johnson'})
    if alice:
        print(f"ALICE: {alice['name']} ({alice['_id']})")
        
    # 3. Check if self-chat exists
    if me:
        self_chat = await db.chats.find_one({
            'is_group': False,
            'participants': {'$all': [str(me['_id']), str(me['_id'])], '$size': 2}
        })
        print(f"SELF-CHAT EXISTS: {True if self_chat else False}")
        
    client.close()

if __name__ == "__main__":
    asyncio.run(check())
