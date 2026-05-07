@echo off
echo Finalizing Secure Chat Tunnel...
ngrok config add-authtoken 3CWVv1MqO3HWGZuA2TBnOcxM6Cw_6meSojCykCHFL4kyghcxU
echo.
echo ---------------------------------------------------
echo YOUR SECURE 4G LINK IS STARTING NOW...
echo ---------------------------------------------------
echo.
ngrok http 8001
pause
