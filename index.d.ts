declare module '@synconset/clarinet' {
    type ParserFactory = () => Parser;

    interface Parser {
        onerror: (err: Error) => void;
        onvalue: (value: string | number | boolean) => void;
        onopenobject: (key: string) => void;
        onkey: (key: string) => void;
        oncloseobject: () => void;
        onopenarray: () => void;
        onclosearray: () => void;
        onend: () => void;

        write(value: string): Parser;
        close(): void;
    }

    export const parser: ParserFactory;
}
