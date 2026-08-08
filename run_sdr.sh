#!/bin/bash
#
# start and stop the GNSS receiver server with Web UI
#
# MSYS2 relays SIGQUIT to a native Windows process as CTRL_BREAK_EVENT, the only
# signal a background pocket_web.exe can catch. Plain kill is TerminateProcess
# and leaves the RF frontend streaming, which needs a USB reset to recover.
#
case $(uname -s) in
    MSYS*|MINGW*|CYGWIN*) SIG=-QUIT;;
    *) SIG=-TERM;;
esac

if [ "$1" = -stop ]; then
    ps -e | awk '/pocket_web/{print $1}' | xargs -r kill $SIG
    for i in $(seq 20); do # wait for the device close before returning
        ps -e | grep -v grep | grep -q pocket_web || break
        sleep 0.5
    done
elif ps -e | grep -v grep | grep -q pocket_web; then
    echo 'pocket_web already running.'
elif [ "$1" = -start ]; then
    ./bin/pocket_web -start -web 0.0.0.0:8080 &
else
    ./bin/pocket_web -web 0.0.0.0:8080 &
fi

