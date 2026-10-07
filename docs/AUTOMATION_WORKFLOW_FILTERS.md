# Filter automations by the event that started a workflow

For a PR reviewer triggered by `workflow_run.completed`, configure:

- Workflow Name: `CI`
- Conclusion: `success`
- Workflow Event: `pull_request`

Workflow Event reads GitHub's `workflow_run.event`, not the webhook action. This rejects successful
default-branch pushes before starting an agent session, while permitting PRs with any head-branch
name. CI failure investigators can use `pull_request`; Acceptance failure investigators can use
`workflow_dispatch`. Keep the agent's open-PR and exact-head checks as a second guard.

The filter is opt-in. Existing automations are unchanged. A configured filter fails closed when the
source event is absent. Deploy the updated GitHub bot, control plane, and web client before adding
it to production automations; older producers do not populate the normalized field.
