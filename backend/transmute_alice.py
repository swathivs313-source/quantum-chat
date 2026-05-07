import motor.motor_asyncio
import asyncio
from bson import ObjectId

async def transmute():
    client = motor.motor_asyncio.AsyncIOMotorClient('mongodb://localhost:27017')
    db = client.test_database
    
    # IDs from previous check
    swathi_id = "69e3178034daf1fdf5d070a4"
    alice_id = "69e23b2c22cb6f5152801e75"
    
    # 1. Find the chat between Swathi and Alice
    chat = await db.chats.find_one({
        "is_group": {"$ne": True},
        "participants": {"$all": [swathi_id, alice_id]}
    })
    
    if chat:
        chat_id = chat["_id"]
        print(f"FOUND CHAT: {chat_id}. TRANSMUTING...")
        
        # 2. Transmute to Self-Chat (Swathi-Swathi)
        await db.chats.update_one(
            {"_id": chat_id},
            {"$set": {"participants": [swathi_id, swathi_id]}}
        )
        print("TRANSMUTATION COMPLETE: Alice slot is now YOUR slot.")
    else:
        # If no chat exists, create it for the Nexus
        print("NO ALICE CHAT FOUND. CREATING NEW NEXUS...")
        await db.chats.insert_one({
            "participants": [swathi_id, swathi_id],
            "is_group": False,
            "last_message": "Welcome to your Personal Nexus.",
            "last_message_at": "2026-04-19T00:00:00Z"
        })
        print("NEW NEXUS CREATED.")
        
    client.close()

if __name__ == "__main__":
    asyncio.run(transmute())
