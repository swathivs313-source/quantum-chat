#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class QuantumSafeChatTester:
    def __init__(self, base_url="https://secure-msg-app-4.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.admin_token = None
        self.user_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, cookies=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if headers:
            test_headers.update(headers)

        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers, cookies=cookies)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers, cookies=cookies)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers, cookies=cookies)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers, cookies=cookies)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            if not success:
                details += f", Expected: {expected_status}"
                try:
                    error_data = response.json()
                    details += f", Error: {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f", Response: {response.text[:100]}"

            self.log_test(name, success, details)
            return success, response.json() if success and response.content else {}

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_health_endpoints(self):
        """Test basic health endpoints"""
        print("\n🔍 Testing Health Endpoints...")
        self.run_test("API Root", "GET", "api/", 200)
        self.run_test("Health Check", "GET", "api/health", 200)

    def test_user_registration(self):
        """Test user registration flow"""
        print("\n🔍 Testing User Registration...")
        
        # Test registration with unique phone number
        timestamp = datetime.now().strftime('%H%M%S%f')
        reg_data = {
            "name": "Test User",
            "email": f"testuser_{timestamp}@example.com",
            "phone_number": f"+123456{timestamp[-4:]}",  # Unique phone number
            "password": "testpass123"
        }
        
        success, response = self.run_test(
            "User Registration", "POST", "api/auth/register", 200, reg_data
        )
        
        if success and 'user_id' in response and 'demo_otp' in response:
            user_id = response['user_id']
            demo_otp = response['demo_otp']
            
            # Test OTP verification immediately to avoid TTL expiry
            otp_data = {"user_id": user_id, "otp_code": demo_otp}
            success, verify_response = self.run_test(
                "OTP Verification", "POST", "api/auth/verify-otp", 200, otp_data
            )
            
            if success and 'access_token' in verify_response:
                self.user_token = verify_response['access_token']
                return True
        
        return False

    def test_admin_login(self):
        """Test admin login flow"""
        print("\n🔍 Testing Admin Login...")
        
        # Test admin login
        login_data = {"email": "admin@quantumsafe.chat", "password": "Admin@123"}
        success, response = self.run_test(
            "Admin Login", "POST", "api/auth/login", 200, login_data
        )
        
        if success and 'user_id' in response and 'demo_otp' in response:
            user_id = response['user_id']
            demo_otp = response['demo_otp']
            
            # Test login OTP verification
            otp_data = {"user_id": user_id, "otp_code": demo_otp}
            success, verify_response = self.run_test(
                "Admin Login OTP", "POST", "api/auth/verify-login-otp", 200, otp_data
            )
            
            if success and 'access_token' in verify_response:
                self.admin_token = verify_response['access_token']
                return True
        
        return False

    def test_demo_user_login(self):
        """Test demo user login"""
        print("\n🔍 Testing Demo User Login...")
        
        # Test alice login
        login_data = {"email": "alice@example.com", "password": "test123"}
        success, response = self.run_test(
            "Demo User Login", "POST", "api/auth/login", 200, login_data
        )
        
        if success and 'user_id' in response and 'demo_otp' in response:
            user_id = response['user_id']
            demo_otp = response['demo_otp']
            
            # Test login OTP verification
            otp_data = {"user_id": user_id, "otp_code": demo_otp}
            success, verify_response = self.run_test(
                "Demo User Login OTP", "POST", "api/auth/verify-login-otp", 200, otp_data
            )
            
            if success and 'access_token' in verify_response:
                return True
        
        return False

    def test_auth_endpoints(self):
        """Test authentication endpoints"""
        print("\n🔍 Testing Auth Endpoints...")
        
        if not self.admin_token:
            print("❌ No admin token available for auth tests")
            return
        
        # Test auth check
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        self.run_test("Auth Check", "GET", "api/auth/me", 200, headers=headers)
        
        # Test logout
        self.run_test("Logout", "POST", "api/auth/logout", 200, headers=headers)

    def test_user_search(self):
        """Test user search functionality"""
        print("\n🔍 Testing User Search...")
        
        if not self.admin_token:
            print("❌ No admin token available for user search tests")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Test search without query
        self.run_test("User Search (empty)", "GET", "api/users/search", 200, headers=headers)
        
        # Test search with query
        self.run_test("User Search (alice)", "GET", "api/users/search?q=alice", 200, headers=headers)

    def test_chat_endpoints(self):
        """Test chat functionality"""
        print("\n🔍 Testing Chat Endpoints...")
        
        if not self.admin_token:
            print("❌ No admin token available for chat tests")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Test get chats
        success, chats_response = self.run_test("Get Chats", "GET", "api/chats", 200, headers=headers)
        
        # Test create chat (need to find a user first)
        success, search_response = self.run_test("Search for Chat Partner", "GET", "api/users/search?q=alice", 200, headers=headers)
        
        if success and search_response.get('users'):
            alice_id = search_response['users'][0]['id']
            
            # Test create chat
            chat_data = {"participant_id": alice_id}
            success, chat_response = self.run_test("Create Chat", "POST", "api/chats", 200, chat_data, headers=headers)
            
            if success and 'chat' in chat_response:
                chat_id = chat_response['chat']['id']
                
                # Test get messages
                self.run_test("Get Messages", "GET", f"api/chats/{chat_id}/messages", 200, headers=headers)
                
                # Test send message
                message_data = {"chat_id": chat_id, "content": "Test encrypted message"}
                self.run_test("Send Message", "POST", "api/messages", 200, message_data, headers=headers)

    def test_group_chat_endpoints(self):
        """Test group chat functionality"""
        print("\n🔍 Testing Group Chat Endpoints...")
        
        if not self.admin_token:
            print("❌ No admin token available for group chat tests")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Get users for group creation
        success, search_response = self.run_test("Search Users for Group", "GET", "api/users/search?q=", 200, headers=headers)
        
        if success and search_response.get('users') and len(search_response['users']) >= 2:
            # Get first two users for group
            member_ids = [user['id'] for user in search_response['users'][:2]]
            
            # Test create group
            group_data = {
                "name": f"Test Group {datetime.now().strftime('%H%M%S')}",
                "member_ids": member_ids
            }
            success, group_response = self.run_test("Create Group", "POST", "api/groups", 200, group_data, headers=headers)
            
            if success and 'chat' in group_response:
                group_id = group_response['chat']['id']
                
                # Test get group members
                self.run_test("Get Group Members", "GET", f"api/groups/{group_id}/members", 200, headers=headers)
                
                # Test get group messages
                self.run_test("Get Group Messages", "GET", f"api/chats/{group_id}/messages", 200, headers=headers)
                
                # Test send group message
                group_message_data = {
                    "chat_id": group_id, 
                    "content": "Test encrypted group message",
                    "message_type": "text"
                }
                self.run_test("Send Group Message", "POST", "api/messages", 200, group_message_data, headers=headers)
                
                # Test add member to group
                if len(search_response['users']) >= 3:
                    new_member_id = search_response['users'][2]['id']
                    add_member_data = {
                        "action": "add",
                        "user_ids": [new_member_id]
                    }
                    self.run_test("Add Group Member", "PUT", f"api/groups/{group_id}/members", 200, add_member_data, headers=headers)
                
                # Verify group appears in chats list with is_group=true
                success, chats_response = self.run_test("Get Chats (verify group)", "GET", "api/chats", 200, headers=headers)
                if success and chats_response.get('chats'):
                    group_found = any(chat.get('is_group') and chat.get('id') == group_id for chat in chats_response['chats'])
                    self.log_test("Group in Chats List", group_found, "Group should appear in chats with is_group=true")

    def test_file_upload_endpoints(self):
        """Test file upload and download functionality"""
        print("\n🔍 Testing File Upload Endpoints...")
        
        if not self.admin_token:
            print("❌ No admin token available for file tests")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Create a test file
        test_file_content = b"This is a test file for quantum-safe chat"
        
        try:
            # Test file upload using multipart form data
            files = {'file': ('test.txt', test_file_content, 'text/plain')}
            response = self.session.post(
                f"{self.base_url}/api/upload",
                files=files,
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            
            success = response.status_code == 200
            if success:
                upload_response = response.json()
                file_id = upload_response.get('file_id')
                self.log_test("File Upload", True, f"File ID: {file_id}")
                
                if file_id:
                    # Test file download
                    download_response = self.session.get(
                        f"{self.base_url}/api/files/{file_id}",
                        headers={"Authorization": f"Bearer {self.admin_token}"}
                    )
                    
                    download_success = download_response.status_code == 200
                    self.log_test("File Download", download_success, f"Status: {download_response.status_code}")
                    
                    # Test sending file message
                    if download_success:
                        # Get a chat to send file to
                        chats_response = self.session.get(
                            f"{self.base_url}/api/chats",
                            headers=headers
                        )
                        
                        if chats_response.status_code == 200:
                            chats_data = chats_response.json()
                            if chats_data.get('chats'):
                                chat_id = chats_data['chats'][0]['id']
                                
                                file_message_data = {
                                    "chat_id": chat_id,
                                    "content": "test.txt",
                                    "message_type": "file",
                                    "file_id": file_id,
                                    "file_name": "test.txt",
                                    "file_type": "text/plain",
                                    "file_size": len(test_file_content)
                                }
                                
                                self.run_test("Send File Message", "POST", "api/messages", 200, file_message_data, headers=headers)
            else:
                self.log_test("File Upload", False, f"Status: {response.status_code}, Response: {response.text[:100]}")
                
        except Exception as e:
            self.log_test("File Upload", False, f"Exception: {str(e)}")

    def test_redis_otp_functionality(self):
        """Test Redis OTP storage and TTL functionality"""
        print("\n🔍 Testing Redis OTP Functionality...")
        
        # Test registration with OTP stored in Redis
        timestamp = datetime.now().strftime('%H%M%S%f')
        reg_data = {
            "name": "Redis Test User",
            "email": f"redistest_{timestamp}@example.com",
            "phone_number": f"+198765{timestamp[-4:]}",  # Unique phone number
            "password": "testpass123"
        }
        
        success, response = self.run_test(
            "Registration with Redis OTP", "POST", "api/auth/register", 200, reg_data
        )
        
        if success and 'user_id' in response:
            user_id = response['user_id']
            
            # Test invalid OTP (should increment retry count in Redis)
            invalid_otp_data = {"user_id": user_id, "otp_code": "000000"}
            self.run_test("Invalid OTP (Redis retry)", "POST", "api/auth/verify-otp", 400, invalid_otp_data)
            
            # Test with correct OTP if available (immediately to avoid TTL expiry)
            if 'demo_otp' in response:
                correct_otp_data = {"user_id": user_id, "otp_code": response['demo_otp']}
                self.run_test("Valid OTP (Redis verification)", "POST", "api/auth/verify-otp", 200, correct_otp_data)

    def test_admin_endpoints(self):
        """Test admin-only endpoints"""
        print("\n🔍 Testing Admin Endpoints...")
        
        if not self.admin_token:
            print("❌ No admin token available for admin tests")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Test admin stats
        self.run_test("Admin Stats", "GET", "api/admin/stats", 200, headers=headers)
        
        # Test admin users
        self.run_test("Admin Users", "GET", "api/admin/users", 200, headers=headers)
        
        # Test admin login logs
        self.run_test("Admin Login Logs", "GET", "api/admin/login-logs", 200, headers=headers)

    def test_unauthorized_access(self):
        """Test unauthorized access to protected endpoints"""
        print("\n🔍 Testing Unauthorized Access...")
        
        # Test protected endpoints without token
        self.run_test("Unauthorized Auth Check", "GET", "api/auth/me", 401)
        self.run_test("Unauthorized User Search", "GET", "api/users/search", 401)
        self.run_test("Unauthorized Get Chats", "GET", "api/chats", 401)
        self.run_test("Unauthorized Admin Stats", "GET", "api/admin/stats", 401)

    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting Quantum-Safe Secure Chat API Tests")
        print(f"🎯 Testing against: {self.base_url}")
        
        # Basic health tests
        self.test_health_endpoints()
        
        # Test unauthorized access first
        self.test_unauthorized_access()
        
        # Test user registration
        self.test_user_registration()
        
        # Test admin login
        admin_login_success = self.test_admin_login()
        
        # Test demo user login
        self.test_demo_user_login()
        
        if admin_login_success:
            # Test authenticated endpoints
            self.test_auth_endpoints()
            self.test_user_search()
            self.test_chat_endpoints()
            self.test_group_chat_endpoints()
            self.test_file_upload_endpoints()
            self.test_redis_otp_functionality()
            self.test_admin_endpoints()
        
        # Print summary
        print(f"\n📊 Test Summary:")
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    tester = QuantumSafeChatTester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open('/app/test_reports/backend_test_results.json', 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "total_tests": tester.tests_run,
            "passed_tests": tester.tests_passed,
            "success_rate": (tester.tests_passed/tester.tests_run*100) if tester.tests_run > 0 else 0,
            "results": tester.test_results
        }, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())