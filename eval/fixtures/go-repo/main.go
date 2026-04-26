package main

import "fmt"

type User struct {
	ID    int
	Name  string
	Email string
}

type UserRepository struct {
	users map[int]*User
	nextID int
}

func NewUserRepository() *UserRepository {
	return &UserRepository{users: make(map[int]*User), nextID: 1}
}

func (r *UserRepository) Create(name, email string) *User {
	u := &User{ID: r.nextID, Name: name, Email: email}
	r.users[r.nextID] = u
	r.nextID++
	return u
}

func (r *UserRepository) FindByID(id int) (*User, bool) {
	u, ok := r.users[id]
	return u, ok
}

func (r *UserRepository) Delete(id int) bool {
	if _, ok := r.users[id]; !ok {
		return false
	}
	delete(r.users, id)
	return true
}

func (r *UserRepository) Count() int {
	return len(r.users)
}

func ValidateEmail(email string) bool {
	for _, c := range email {
		if c == '@' {
			return true
		}
	}
	return false
}

func FormatUser(u *User) string {
	return fmt.Sprintf("%s <%s>", u.Name, u.Email)
}

func main() {
	repo := NewUserRepository()
	u := repo.Create("Alice", "alice@example.com")
	fmt.Println(FormatUser(u))
}
