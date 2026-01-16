# Troubleshooting

## Daemon won\'t start

- Ensure `tmux` is installed and on PATH.
- Ensure port `4141` is free.
- Check tmux session: `tmux ls`.

## UI shows no services

- Confirm the config file exists and is valid JSON.
- Confirm `DEVSERVER_CONFIG` is not pointing elsewhere.
- Run `curl http://127.0.0.1:4141/services` to verify daemon.

## Logs not streaming

- Ensure service window exists in tmux.
- The UI only requests logs after you click "Logs".

## tmux session confusion

- Everything lives in `devservers`.
- Attach with `tmux attach -t devservers`.
