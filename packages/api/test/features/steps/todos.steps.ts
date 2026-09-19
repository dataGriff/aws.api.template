import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { invoke } from "../../helpers/invoke.js";
import type { TodoWorld } from "./world.js";

Given(
  "I am authenticated as user {string} in tenant {string}",
  function (this: TodoWorld, user: string, tenant: string) {
    this.claims = { sub: user, "custom:tenant_id": tenant };
  },
);

async function createTodo(world: TodoWorld, title: string) {
  world.response = await invoke({
    method: "POST",
    resource: "/todos",
    body: { title },
    claims: world.claims,
  });
  const body = world.body() as { todo_id?: string };
  if (body?.todo_id) world.lastTodoId = body.todo_id;
}

When("I create a todo titled {string}", async function (this: TodoWorld, title: string) {
  await createTodo(this, title);
});

Given("I have created a todo titled {string}", async function (this: TodoWorld, title: string) {
  await createTodo(this, title);
});

When("I list my todos", async function (this: TodoWorld) {
  this.response = await invoke({ method: "GET", resource: "/todos", claims: this.claims });
});

When("an unauthenticated user lists todos", async function (this: TodoWorld) {
  this.response = await invoke({ method: "GET", resource: "/todos", claims: null });
});

When(
  "user {string} in tenant {string} fetches that todo",
  async function (this: TodoWorld, user: string, tenant: string) {
    this.response = await invoke({
      method: "GET",
      resource: "/todos/{todo_id}",
      pathParameters: { todo_id: this.lastTodoId! },
      claims: { sub: user, "custom:tenant_id": tenant },
    });
  },
);

When(
  "user {string} in tenant {string} updates that todo's title to {string}",
  async function (this: TodoWorld, user: string, tenant: string, title: string) {
    this.response = await invoke({
      method: "PATCH",
      resource: "/todos/{todo_id}",
      pathParameters: { todo_id: this.lastTodoId! },
      body: { title },
      claims: { sub: user, "custom:tenant_id": tenant },
    });
  },
);

When(
  "user {string} in tenant {string} deletes that todo",
  async function (this: TodoWorld, user: string, tenant: string) {
    this.response = await invoke({
      method: "DELETE",
      resource: "/todos/{todo_id}",
      pathParameters: { todo_id: this.lastTodoId! },
      claims: { sub: user, "custom:tenant_id": tenant },
    });
  },
);

When("I fetch that todo", async function (this: TodoWorld) {
  this.response = await invoke({
    method: "GET",
    resource: "/todos/{todo_id}",
    pathParameters: { todo_id: this.lastTodoId! },
    claims: this.claims,
  });
});

When("I delete the todo {string}", async function (this: TodoWorld, id: string) {
  this.response = await invoke({
    method: "DELETE",
    resource: "/todos/{todo_id}",
    pathParameters: { todo_id: id },
    claims: this.claims,
  });
});

Then("the response status is {int}", function (this: TodoWorld, status: number) {
  assert.equal(this.response?.statusCode, status);
});

Then("the todo has status {string}", function (this: TodoWorld, status: string) {
  const body = this.body() as { status?: string };
  assert.equal(body.status, status);
});

Then("the todo has title {string}", function (this: TodoWorld, title: string) {
  const body = this.body() as { title?: string };
  assert.equal(body.title, title);
});

Then("the list contains exactly {int} todos", function (this: TodoWorld, n: number) {
  const body = this.body() as { items?: unknown[] };
  assert.equal(body.items?.length ?? 0, n);
});

Then("the error is problem+json", function (this: TodoWorld) {
  assert.equal(this.response?.headers?.["content-type"], "application/problem+json");
});
