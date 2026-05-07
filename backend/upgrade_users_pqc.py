import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from pqc import ml_kem768, ml_dsa65
import base64

# Simple Base64 helper
def bytes_to_b64(b):
    return base64.b64encode(b).decode('utf-8')

async def upgrade_users():
    mongo_url = "mongodb://localhost:27017"
    client = AsyncIOMotorClient(mongo_url)
    db = client["test_database"]
    
    users = await db.users.find({}).to_list(100)
    print(f"Found {len(users)} users. Checking for PQC readiness...")
    
    for user in users:
        needs_upgrade = False
        update_data = {}
        
        if not user.get("kyber_pubkey"):
            print(f"Upgrading Kyber (KEM) for {user['email']}...")
            kem_pk, kem_sk = ml_kem768.keygen()
            update_data["kyber_pubkey"] = bytes_to_b64(kem_pk)
            update_data["kyber_privkey"] = bytes_to_b64(kem_sk) # Strictly for vault simulation logic
            needs_upgrade = True
            
        if not user.get("dilithium_pubkey"):
            print(f"Upgrading Dilithium (DSA) for {user['email']}...")
            dsa_pk, dsa_sk = ml_dsa65.keygen()
            update_data["dilithium_pubkey"] = bytes_to_b64(dsa_pk)
            update_data["dilithium_privkey"] = bytes_to_b64(dsa_sk) 
            needs_upgrade = True
            
        if needs_upgrade:
            await db.users.update_one({"_id": user["_id"]}, {"$set": update_data})
            print(f"Successfully upgraded {user['email']}! ✅")

    print("All users are now Quantum-Ready. 🛡️")

if __name__ == "__main__":
    asyncio.run(upgrade_users())
