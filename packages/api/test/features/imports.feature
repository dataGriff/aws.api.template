Feature: Importing todos from a CSV file
  As an authenticated user
  I want to upload a CSV file of todos
  So that many todos are created at once — all of them, or none

  # The file format is its own contract (api/todo-import.odcs.yaml). A file is
  # accepted as a whole or rejected as a whole; a rejected file is quarantined
  # with a report and never creates a todo.

  Background:
    Given I am authenticated as user "alice" in tenant "acme"

  Scenario: A file that meets the data contract creates every row for me
    Given a CSV file "todos.csv" with the rows:
      | title              | description | status      | due_date   |
      | Write the tutorial | Local stack | open        | 2030-01-31 |
      | Renew certificate  |             | in_progress |            |
    When I upload it through an import
    Then the import status is "completed"
    And the import reports 2 rows and 2 created
    When I list my todos
    Then the list contains exactly 2 todos

  Scenario: One bad row rejects the whole file, creates nothing and quarantines it
    Given a CSV file "todos.csv" with the rows:
      | title    | description | status   | due_date |
      | Good row |             | open     |          |
      | Bad row  |             | archived |          |
    When I upload it through an import
    Then the import status is "rejected"
    And the import reports 2 rows and 0 created
    And the import reports an error on row 2 for "status"
    And the file is quarantined with a report
    When I list my todos
    Then the list contains exactly 0 todos

  Scenario: A file with an unexpected column is rejected before any row is read
    Given a CSV file "todos.csv" with the rows:
      | title | owner |
      | X     | bob   |
    When I upload it through an import
    Then the import status is "rejected"
    And the import reports an error on row 0 for "header"

  Scenario: Another user cannot see my import
    Given a CSV file "todos.csv" with the rows:
      | title | description | status | due_date |
      | Mine  |             | open   |          |
    When I upload it through an import
    When user "bob" in tenant "acme" fetches that import
    Then the response status is 404
