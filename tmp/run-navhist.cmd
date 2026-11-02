@echo off
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot
set PATH=%JAVA_HOME%\bin;%PATH%
cd /d d:\Work\D-Arrow-Business
call npx -y firebase-tools@13.35.1 emulators:exec --only auth,firestore --project test-nav-history-browser "node scripts/test-nav-history-browser.mjs" > tmp\nav-history-browser\run9.log 2>&1
echo EXITCODE=%ERRORLEVEL%>> tmp\nav-history-browser\run9.log
