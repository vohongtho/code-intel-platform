<?php

namespace App\Services;

use App\Models\User;

/**
 * Service for managing users.
 */
class UserService
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function getUser(int $id): ?User
    {
        return null;
    }

    public function saveUser(User $user): void
    {
        // implementation
    }

    private function formatName(string $input): string
    {
        return trim($input);
    }
}

interface UserRepository
{
    public function findAll(): array;
    public function findById(int $id): ?User;
}

trait Loggable
{
    public function log(string $message): void
    {
        echo $message;
    }
}
