import { helper } from "./helpers";

export function greet(name: string): string {
    helper();
    return name.toUpperCase();
}

export class Dog extends Animal implements Barkable {
    bark(): string {
        return woof();
    }

    fetch(item: string): string {
        return item;
    }
}

export const chain = (x: string) => greet(x);
