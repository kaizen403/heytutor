import type { ExpressionNodeIR } from "./problemIR";

/** Bounded arithmetic syntax used by source working; no evaluation shortcuts. */
export function parseSuvatProofExpression(text:string):ExpressionNodeIR {
  if(text.length>512)throw new Error("SUVAT working is too long");
  const tokens:string[]=[];
  let at=0,position=0,depth=0;
  while(position<text.length){
    const match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^[uvats]|^[()+*/^-]/.exec(text.slice(position));
    if(!match||tokens.length>128)throw new Error("unsupported SUVAT working token");
    tokens.push(match[0]);position+=match[0].length;
  }
  const binary=(operator:"+"|"-"|"*"|"/"|"^",left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:"binary",operator,left,right});
  function primary():ExpressionNodeIR {
    if(++depth>24)throw new Error("SUVAT working nesting exceeded");
    const token=tokens[at++];let node:ExpressionNodeIR;
    if(token==="("){node=sum();if(tokens[at++]!==")")throw new Error("unclosed SUVAT expression");}
    else if(token&&/^[uvats]$/.test(token))node={kind:"variable",name:token};
    else if(token&&/^(?:\d|\.)/.test(token)&&Number.isFinite(Number(token)))node={kind:"number",value:Number(token)};
    else throw new Error("invalid SUVAT primary");
    depth--;return node;
  }
  function power():ExpressionNodeIR {const left=primary();return tokens[at]==="^"?(at++,binary("^",left,unary())):left;}
  function unary():ExpressionNodeIR {
    if(tokens[at]==="+"||tokens[at]==="-"){
      if(++depth>24)throw new Error("SUVAT unary nesting exceeded");
      const operator=tokens[at++] as "+"|"-",operand=unary();depth--;
      // A signed numeric literal has exactly the same source identity as its
      // typed number node. No nonliteral subtree is simplified.
      return operand.kind==="number"?{kind:"number",value:operator==="-"?-operand.value:operand.value}:{kind:"unary",operator,operand};
    }
    return power();
  }
  function product():ExpressionNodeIR {let value=unary();while(tokens[at]==="*"||tokens[at]==="/"){const operator=tokens[at++] as "*"|"/";value=binary(operator,value,unary());}return value;}
  function sum():ExpressionNodeIR {let value=product();while(tokens[at]==="+"||tokens[at]==="-"){const operator=tokens[at++] as "+"|"-";value=binary(operator,value,product());}return value;}
  const root=sum();if(at!==tokens.length)throw new Error("unconsumed SUVAT working");return root;
}
