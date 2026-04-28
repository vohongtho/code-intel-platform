# Ruby fixture — parser corpus

module Services
  # Service for managing users
  class UserService
    attr_reader :name

    def initialize(name)
      @name = name
    end

    def get_user(id)
      nil
    end

    def save_user(user)
      # implementation
    end

    private

    def format_name(input)
      input.strip
    end
  end

  module Helpers
    def self.calculate(x, y)
      x + y
    end
  end
end

def top_level_helper
  "helper"
end
