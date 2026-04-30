package com.example;

import java.util.List;
import java.util.Optional;

/**
 * Service for managing users.
 */
public class UserService {

    private final String name;

    /** Creates a new UserService. */
    public UserService(String name) {
        this.name = name;
    }

    /** Returns the user by ID. */
    public Optional<String> getUser(int id) {
        return Optional.empty();
    }

    /** Saves user data. */
    public void saveUser(String user) {
        // implementation
    }

    private String formatName(String input) {
        return input.trim();
    }
}

/** Repository interface for data access. */
public interface UserRepository {
    List<String> findAll();
    Optional<String> findById(int id);
}

/** User roles. */
public enum Role {
    ADMIN,
    USER,
    GUEST
}
