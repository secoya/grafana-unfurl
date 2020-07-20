allow_k8s_contexts('microk8s')
k8s_yaml(kustomize('deploy/dev'))
docker_build('localhost:32000/ops/grafana-unfurl', 'deploy/dev')
local_resource('yarn', cmd='yarn install', deps=['package.json'])
