class UserService:
    def greet(self):
        return 'hi'
class AdminService(UserService):
    pass
def create_user(name):
    return UserService()
def _private_helper():
    return None
