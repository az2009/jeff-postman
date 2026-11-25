@echo off
rem Roda o comando de terminal do JEFF Postman com o Node embutido no app (sem precisar instalar Node).
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\JEFF Postman.exe" "%~dp0app.asar\out\cli\jeff-postman.js" %*
