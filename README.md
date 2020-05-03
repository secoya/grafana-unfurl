## Development

In order for grafana-unfurl to receive Slack events locally, forward the requests
with ngrok:

```
$ ngrok http -host-header=grafana-unfurl.kube https://grafana-unfurl.kube:443
```

Then adjust the [oauth redirect](https://api.slack.com/apps/A010UL276TA/oauth),
[interaction](https://api.slack.com/apps/A010UL276TA/interactive-messages),
and [event](https://api.slack.com/apps/A010UL276TA/event-subscriptions) endpoints
in the Slack grafana-unfurl dev app
