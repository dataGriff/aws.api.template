Feature: Managing todos
  As an authenticated user
  I want to manage my own todos
  So that only I can see and change them

  Background:
    Given I am authenticated as user "alice" in tenant "acme"

  Scenario: Create a todo
    When I create a todo titled "Write the tutorial"
    Then the response status is 201
    And the todo has status "open"

  Scenario: List my todos
    Given I have created a todo titled "First"
    And I have created a todo titled "Second"
    When I list my todos
    Then the response status is 200
    And the list contains exactly 2 todos

  # Tenant isolation is asserted on each axis independently so that dropping
  # either predicate (tenant_id or user_sub) from the repository fails a test.
  Scenario: The same user in another tenant cannot see the todo
    Given I have created a todo titled "Confidential"
    When user "alice" in tenant "other" fetches that todo
    Then the response status is 404

  Scenario: Another user in the same tenant cannot see the todo
    Given I have created a todo titled "Confidential"
    When user "bob" in tenant "acme" fetches that todo
    Then the response status is 404

  Scenario: Another user in the same tenant cannot modify or delete the todo
    Given I have created a todo titled "Confidential"
    When user "bob" in tenant "acme" updates that todo's title to "Hijacked"
    Then the response status is 404
    When user "bob" in tenant "acme" deletes that todo
    Then the response status is 404
    When I fetch that todo
    Then the response status is 200
    And the todo has title "Confidential"

  Scenario: Deleting a missing todo is a 404
    When I delete the todo "11111111-1111-1111-1111-111111111111"
    Then the response status is 404
    And the error is problem+json

  Scenario: Requests without a token are rejected
    When an unauthenticated user lists todos
    Then the response status is 401
