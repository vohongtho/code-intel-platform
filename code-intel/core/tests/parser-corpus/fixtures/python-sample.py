# Python fixture — parser corpus

class UserService:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"

    def _internal(self):
        pass


class AdminService(UserService):
    pass


def create_user(username, role):
    return UserService(username)


def _private_helper():
    pass


DEFAULT_ROLE = 'viewer'
