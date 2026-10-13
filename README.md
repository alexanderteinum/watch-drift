# watch-drift

A local app for tracking the accuracy of mechanical watches.

![watch-drift screenshot](screenshot.png)

## Run locally

Requires Python 3.9 or newer.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). Your data is saved locally in `watches.db`, created on first run. Stop the app with Ctrl+C.

## Use

1. Add and select a watch.
2. Start a measurement series.
3. Log deviations. The app calculates its rate in seconds per day (s/d).

## Local access

The app listens only on `127.0.0.1`, and is available only on the computer running it.
