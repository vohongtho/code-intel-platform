package com.example;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public class UserRepository {
    private final Map<Integer, User> users = new HashMap<>();
    private int nextId = 1;

    public User create(String name, String email) {
        User user = new User(nextId, name, email);
        users.put(nextId, user);
        nextId++;
        return user;
    }

    public Optional<User> findById(int id) {
        return Optional.ofNullable(users.get(id));
    }

    public boolean delete(int id) {
        return users.remove(id) != null;
    }

    public int count() {
        return users.size();
    }
}

class User {
    private final int id;
    private String name;
    private String email;

    public User(int id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }

    public int getId() { return id; }
    public String getName() { return name; }
    public String getEmail() { return email; }
    public void setName(String name) { this.name = name; }
}

class EmailValidator {
    public static boolean validate(String email) {
        return email != null && email.contains("@") && email.contains(".");
    }

    public static String format(User user) {
        return user.getName() + " <" + user.getEmail() + ">";
    }
}
