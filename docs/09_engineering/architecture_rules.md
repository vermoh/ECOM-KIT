# Architecture Rules

- no business logic в controllers
- все jobs через queue
- все queries tenant scoped
- services stateless
- strict module boundaries