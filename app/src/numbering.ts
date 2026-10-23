import OrderedList from '@tiptap/extension-ordered-list';
import {isNodeActive} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {Plugin,PluginKey,type EditorState} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import {canJoin} from '@tiptap/pm/transform';

type NumberingState=Pick<EditorState,'doc'|'selection'>;
export const listStart=(node:ProseMirrorNode):number=>Number.isSafeInteger(node.attrs.start)&&node.attrs.start>=1?node.attrs.start:1;
const numeric=(node:ProseMirrorNode)=>node.type.name==='orderedList'&&(!node.attrs.type||node.attrs.type==='1');
export function listContext(state:NumberingState){
  const {$from}=state.selection;
  for(let depth=$from.depth;depth>0;depth--){
    const node=$from.node(depth);
    if(node.type.name==='orderedList'||node.type.name==='bulletList')return {parent:$from.node(depth-1),parentStart:depth===1?0:$from.start(depth-1),index:$from.index(depth-1),list:{node,pos:$from.before(depth)}};
  }
  if($from.depth===0&&state.doc.childCount===1){
    const node=state.doc.firstChild!;
    if(node.type.name==='orderedList'||node.type.name==='bulletList')return {parent:state.doc,parentStart:0,index:0,list:{node,pos:0}};
  }
  const depth=Math.max(0,$from.depth-1);
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
function joinPreviousGroup(tr:import('@tiptap/pm/state').Transaction){
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
      toggleOrderedList:()=>props=>{
        if(!props.editor.isEditable)return false;
        const wasActive=isNodeActive(props.state,this.name),previous=previousNumberedList(props.state);
        if(props.dispatch)closeHistory(props.tr);
        if(wasActive)return parent?.toggleOrderedList?.()(props)??false;
        const attributes={start:previous?listStart(previous.node)+previous.node.childCount:1,continuePrevious:!!previous};
        const current=listContext(props.state).list,type=props.state.schema.nodes[this.name],range=props.state.selection.$from.blockRange(props.state.selection.$to);
        const wholeDocList=props.state.doc.childCount===1&&props.state.selection.from===0&&props.state.selection.to===props.state.doc.content.size;
        if(current?.node.type.name==='bulletList'&&type.validContent(current.node.content)&&(wholeDocList||range&&range.depth>=1&&range.depth-props.tr.doc.resolve(current.pos).depth-1<=1)){
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
