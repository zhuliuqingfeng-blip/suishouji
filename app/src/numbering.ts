import OrderedList from '@tiptap/extension-ordered-list';
import {commands as baseCommands,getNodeType,type Command} from '@tiptap/core';
import type {Node as ProseMirrorNode,NodeType} from '@tiptap/pm/model';
import {Plugin,PluginKey,TextSelection,type EditorState,type Transaction} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import {canJoin} from '@tiptap/pm/transform';

type NumberingState=Pick<EditorState,'doc'|'selection'>;
export const listStart=(node:ProseMirrorNode):number=>Number.isSafeInteger(node.attrs.start)&&node.attrs.start>=1?node.attrs.start:1;
const numeric=(node:ProseMirrorNode)=>node.type.name==='orderedList'&&(!node.attrs.type||node.attrs.type==='1');
const listNode=(node:ProseMirrorNode)=>node.type.name==='orderedList'||node.type.name==='bulletList';
export function listContext(state:NumberingState){
  const {$from,$to,from,to}=state.selection,range=$from.blockRange($to);
  if(from===0&&to===state.doc.content.size&&state.doc.childCount===1){
    const node=state.doc.firstChild!;
    if(listNode(node))return {parent:state.doc,parentStart:0,index:0,list:{node,pos:0}};
  }
  const depth=range?.depth??Math.max(0,$from.depth-1),parent=$from.node(depth);
  // A selection inside a list item or spanning its sibling items operates on
  // that list. Other block containers (e.g. quotes) are wrapping scopes of their
  // own; an enclosing list beyond that range must not count as the active list.
  const listDepth=listNode(parent)?depth:depth>0&&listNode($from.node(depth-1))?depth-1:0;
  if(listDepth>0)return {parent:$from.node(listDepth-1),parentStart:listDepth===1?0:$from.start(listDepth-1),index:$from.index(listDepth-1),list:{node:$from.node(listDepth),pos:$from.before(listDepth)}};
  return {parent:$from.node(depth),parentStart:depth===0?0:$from.start(depth),index:$from.index(depth),list:null};
}
export function previousNumberedList(state:NumberingState){
  const context=listContext(state);let previous:{node:ProseMirrorNode;pos:number}|null=null;
  context.parent.forEach((node,offset,index)=>{
    if(index>=context.index)return;
    if(node.type.name==='orderedList')previous=numeric(node)?{node,pos:context.parentStart+offset}:null;
  });
  return previous as {node:ProseMirrorNode;pos:number}|null;
}
export function numberingChanges(doc:ProseMirrorNode){
  const changes:{pos:number;start:number}[]=[];
  function visit(parent:ProseMirrorNode,contentStart:number){
    let next:number|undefined;
    parent.forEach((node,offset)=>{
      const pos=contentStart+offset;
      if(numeric(node)){
        const start=node.attrs.continuePrevious===true?(next??1):listStart(node);
        if(start!==node.attrs.start)changes.push({pos,start});
        next=start+node.childCount;
      }else if(node.type.name==='orderedList')next=undefined;
      if(node.childCount)visit(node,pos+1);
    });
  }
  visit(doc,0);return changes;
}
const normalizationKey=new PluginKey('continuous-numbering');
// Lifting a middle item copies the original list attributes onto both halves.
// Only the surviving suffix of that same list becomes a continuation; existing
// independent lists and halves moved to different nested parents stay intact.
function continueSplitSuffix(tr:Transaction,source:{node:ProseMirrorNode;pos:number},stepStart=0){
  if(!numeric(source.node)||source.node.childCount<3)return;
  const mapping=tr.mapping.slice(stepStart);
  const contextAt=(position:number)=>{
    const mapped=mapping.mapResult(position);
    if(mapped.deletedAcross||!tr.doc.resolve(mapped.pos).parent.inlineContent)return null;
    return listContext({doc:tr.doc,selection:TextSelection.create(tr.doc,mapped.pos)});
  };
  // Map positions inside the first paragraph of the first/last original item.
  // Earlier steps in a chained command already precede these source positions.
  const first=contextAt(source.pos+3);
  const last=contextAt(source.pos+source.node.nodeSize-source.node.lastChild!.nodeSize+1);
  if(!first?.list||!last?.list||first.parent!==last.parent||first.index>=last.index||!numeric(first.list.node)||!numeric(last.list.node))return;
  tr.setNodeMarkup(last.list.pos,undefined,{...last.list.node.attrs,continuePrevious:true});
}
function numberedLift(command:Command,itemType?:string|NodeType):Command{return props=>{
  if(!props.editor.isEditable)return false;
  // Lifting may deliberately cross a quote to its enclosing list item. Match
  // the upstream lift range instead of reusing the paragraph-wrapping scope.
  const type=itemType?getNodeType(itemType,props.state.schema):null;
  const {$from,$to}=props.state.selection,range=type?$from.blockRange($to,node=>node.firstChild?.type===type):null;
  const source=type?(range&&range.depth>0&&listNode(range.parent)?{node:range.parent,pos:$from.before(range.depth)}:null):listContext(props.state).list;
  const stepStart=props.tr.steps.length;
  const result=command(props);
  if(result&&props.dispatch&&source&&numeric(source.node)){
    closeHistory(props.tr);continueSplitSuffix(props.tr,source,stepStart);
  }
  return result;
};}
function joinPreviousGroup(tr:Transaction){
  const current=listContext({doc:tr.doc,selection:tr.selection}).list;
  if(!current||!numeric(current.node))return true;
  const before=tr.doc.resolve(current.pos).nodeBefore;
  if(before&&numeric(before)&&canJoin(tr.doc,current.pos))tr.join(current.pos);
  return true;
}
export function continuationPlugin(){return new Plugin({
  key:normalizationKey,
  appendTransaction(transactions,_old,state){
    if(!transactions.some(tr=>tr.docChanged)||transactions.some(tr=>tr.getMeta(normalizationKey)||tr.getMeta('preventUpdate')))return null;
    const changes=numberingChanges(state.doc);if(!changes.length)return null;
    const tr=state.tr;
    for(const {pos,start} of changes){const node=tr.doc.nodeAt(pos)!;tr.setNodeMarkup(pos,undefined,{...node.attrs,start});}
    // Appended steps share the user's history event: undo restores both the
    // edited item and the dependent numbers, without a second undo action.
    return tr.setMeta(normalizationKey,true);
  }
});}

declare module '@tiptap/core' {
  interface Commands<ReturnType>{continuousNumbering:{
    continueNumbering:()=>ReturnType;
    restartNumbering:()=>ReturnType;
  }}
}
export const ContinuousOrderedList=OrderedList.extend({
  addAttributes(){return {...this.parent?.(),continuePrevious:{default:false,rendered:false}};},
  addCommands(){
    const parent=this.parent?.();
    return {...parent,
      // Share split repair across Shift+Tab, Backspace, toolbar, direct commands
      // and Enter exiting an empty item; preserve upstream behavior otherwise.
      liftListItem:typeOrName=>numberedLift(baseCommands.liftListItem(typeOrName),typeOrName),
      liftEmptyBlock:()=>numberedLift(baseCommands.liftEmptyBlock()),
      toggleOrderedList:()=>props=>{
        if(!props.editor.isEditable)return false;
        const current=listContext(props.state).list,wasActive=current?.node.type.name===this.name,previous=previousNumberedList(props.state);
        if(props.dispatch)closeHistory(props.tr);
        if(wasActive){
          const wholeDocList=props.state.selection.from===0&&props.state.selection.to===props.state.doc.content.size&&props.state.doc.childCount===1;
          return wholeDocList?(parent?.toggleOrderedList?.()(props)??false):props.commands.liftListItem(this.options.itemTypeName);
        }
        const attributes={start:previous?listStart(previous.node)+previous.node.childCount:1,continuePrevious:!!previous};
        const type=props.state.schema.nodes[this.name];
        if(current?.node.type.name==='bulletList'&&type.validContent(current.node.content)){
          if(props.dispatch){props.tr.setNodeMarkup(current.pos,type,attributes);joinPreviousGroup(props.tr);}
          return true;
        }
        // Use the standard wrapping primitive, but only merge backwards.
        // A following independent list must retain its own starting number.
        return props.chain().command(({can,commands})=>can().wrapInList(this.name,attributes)||commands.clearNodes()).wrapInList(this.name,attributes).command(({tr})=>joinPreviousGroup(tr)).run();
      },
      continueNumbering:()=>({state,tr,dispatch,editor})=>{
        if(!editor.isEditable)return false;
        const current=listContext(state).list,previous=previousNumberedList(state);
        if(!current||!numeric(current.node)||!previous)return false;
        if(dispatch)closeHistory(tr).setNodeMarkup(current.pos,undefined,{...current.node.attrs,start:listStart(previous.node)+previous.node.childCount,continuePrevious:true});
        return true;
      },
      restartNumbering:()=>({state,tr,dispatch,editor})=>{
        if(!editor.isEditable)return false;
        const current=listContext(state).list;if(!current||!numeric(current.node))return false;
        if(dispatch)closeHistory(tr).setNodeMarkup(current.pos,undefined,{...current.node.attrs,start:1,continuePrevious:false});
        return true;
      }
    };
  },
  addProseMirrorPlugins(){return [...(this.parent?.()??[]),continuationPlugin()];}
});
