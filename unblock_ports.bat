@echo off
echo Opening ports 3000 and 8001 for Quantum Chat...
netsh advfirewall firewall add rule name="Quantum Chat Frontend" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="Quantum Chat Backend" dir=in action=allow protocol=TCP localport=8001
echo Done! Please refresh your phone browser now.
pause
