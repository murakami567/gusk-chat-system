import importlib

main_module = importlib.import_module("app.main")
guard_module = importlib.import_module("app.security_message_guard")

guard_module.install_message_permission_guard(main_module.app, main_module.SECRET_KEY)

app = main_module.app
