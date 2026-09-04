# Open-Inspect Domain Language

Open-Inspect coordinates coding sessions across model providers, user-facing selectors, and
automated integrations. These terms keep model availability and reasoning behavior precise across
those surfaces.

## Language

**Model route**:

A canonical `provider/model` identity for accessing a model through one provider. The same
underlying model offered by different providers has a distinct model route for each provider.
_Avoid_: Model slug, model name when the provider matters

**Reasoning effort**:

A caller-selectable level from a model route's declared reasoning ladder. A reasoning effort is
valid only when that exact route offers it. _Avoid_: Thinking level, universal effort

**Built-in reasoning**:

Reasoning performed by a model route that offers no caller-selectable reasoning effort. Built-in
reasoning must not be described as unsupported reasoning. _Avoid_: No reasoning, unsupported
reasoning

**Enabled model**:

A model route permitted by workspace model settings and therefore eligible for session and
integration selectors. _Avoid_: Available model when referring only to upstream provider
availability
