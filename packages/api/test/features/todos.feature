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
    And the list contains at least 2 todos

  Scenario: Tenant isolation hides other tenants' todos
    Given I have created a todo titled "Confidential"
    When user "bob" in tenant "other" fetches that todo
    Then the response status is 404

  Scenario: Deleting a missing todo is a 404
    When I delete the todo "11111111-1111-1111-1111-111111111111"
    Then the response status is 404
    And the error is problem+json

  Scenario: Requests without a token are rejected
    When an unauthenticated user lists todos
    Then the response status is 401
