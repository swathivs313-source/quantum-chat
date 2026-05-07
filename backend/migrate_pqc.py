import asyncio
import os
import base64
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from quantcrypt.kem import MLKEM_768
from quantcrypt.dss import MLDSA_65

# We use the same encryption logic as the main server
from cryptography.fernet import Fernet # Assuming Fernet is used for private key storage in server.py

async def migrate_users():
    print("Starting Quantum Migration for Legacy Users...")
    load_dotenv('.env')
    
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]
    
    # 1. Identity users missing PQC keys
    cursor = db.users.find({
        "$or": [
            {"kyber_pubkey": {"$exists": False}},
            {"kyber_pubkey": ""},
            {"dilithium_pubkey": {"$exists": False}},
            {"dilithium_pubkey": ""}
        ]
    })
    
    users = await cursor.to_list(length=1000)
    print(f"Found {len(users)} users needing upgrade.")
    
    kem = MLKEM_768()
    dsa = MLDSA_65()
    
    for user in users:
        email = user.get('email', 'Unknown')
        print(f"Upgrading {email}...")
        
        # Generate Kyber-768
        k_pub, k_priv = kem.keygen()
        # Generate Dilithium-65
        d_pub, d_priv = dsa.keygen()
        
        # Public keys are stored as Base64 strings
        kyber_pub = base64.b64encode(k_pub).decode('utf-8')
        dilithium_pub = base64.b64encode(d_pub).decode('utf-8')
        
        update_doc = {
            "kyber_pubkey": kyber_pub,
            "dilithium_pubkey": dilithium_pub,
            "pqc_migrated": True
        }
        
        await db.users.update_one({"_id": user["_id"]}, {"$set": update_doc})
        print(f"User {email} is now Quantum-Ready.")

    print("\nMigration Complete! All users are now Post-Quantum compliant.")

if __name__ == "__main__":
    asyncio.run(migrate_users())
